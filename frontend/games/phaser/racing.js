registerGame("racing", "🏎️ Racing", "W/S+A/D = P1, ↑↓←→ = P2", "First to 3 laps wins", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a2a1a");
    const g=this.add.graphics();
    g.lineStyle(60,0x333333);g.strokeEllipse(W/2,H/2,600,350);
    g.lineStyle(2,0xffff00,0.5);g.strokeEllipse(W/2,H/2,600,350);
    // Checkpoint line
    this.add.rectangle(W/2,H/2-175,80,4,0xff4444);
    this.p1=this.add.rectangle(W/2-15,H/2-175,16,10,0xf7c948);
    this.p2=this.add.rectangle(W/2+15,H/2-175,16,10,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setDrag(150);p.body.setMaxVelocity(250);p.setData("lap",0);p.setData("angle",0);p.setData("half",false);});
    this.physics.add.collider(this.p1,this.p2);
    this.lapTxt=this.add.text(W/2,20,"P1: 0/3 laps  |  P2: 0/3 laps",{fontSize:"18px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT"});
    this.over=false;
  }
  drive(p,fwd,bk,left,right){
    let a=p.getData("angle");
    if(left)a-=0.04;if(right)a+=0.04;p.setData("angle",a);p.setRotation(a);
    if(fwd){p.body.setAcceleration(Math.cos(a)*400,Math.sin(a)*400);}
    else if(bk){p.body.setAcceleration(Math.cos(a)*-200,Math.sin(a)*-200);}
    else p.body.setAcceleration(0);
  }
  checkLap(p,name){
    // Bottom half checkpoint
    if(p.y>H/2)p.setData("half",true);
    // Cross finish line at top
    if(p.getData("half")&&p.y<H/2-160&&Math.abs(p.x-W/2)<50){
      p.setData("half",false);p.setData("lap",p.getData("lap")+1);
      this.lapTxt.setText("P1: "+this.p1.getData("lap")+"/3  |  P2: "+this.p2.getData("lap")+"/3");
      if(p.getData("lap")>=3&&!this.over){this.over=true;this.physics.pause();this.add.text(W/2,H/2,name+" WINS!",{fontSize:"40px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}
    }
  }
  update(){if(this.over)return;const k=this.k;
    this.drive(this.p1,k.w.isDown,k.s.isDown,k.a.isDown,k.d.isDown);
    this.drive(this.p2,k.up.isDown,k.down.isDown,k.left.isDown,k.right.isDown);
    this.checkLap(this.p1,"P1");this.checkLap(this.p2,"P2");
  }
});
