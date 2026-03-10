registerGame("hungry-hippos", "🦛 Hungry Hippos", "WASD = P1, Arrows = P2", "Collect the most balls!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1e2a1a");
    this.p1=this.add.circle(80,H/2,20,0xf7c948);this.p2=this.add.circle(W-80,H/2,20,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true).setDrag(200);});
    this.physics.add.collider(this.p1,this.p2);
    this.balls=this.physics.add.group();
    for(let i=0;i<20;i++){
      const b=this.add.circle(Phaser.Math.Between(150,W-150),Phaser.Math.Between(50,H-50),8,0xffffff);
      this.balls.add(b);this.physics.add.existing(b);b.body.setBounce(0.8).setDrag(50).setCollideWorldBounds(true);
      b.body.setVelocity(Phaser.Math.Between(-100,100),Phaser.Math.Between(-100,100));
    }
    this.s1=0;this.s2=0;
    this.sTxt=this.add.text(W/2,16,"P1: 0 | P2: 0",{fontSize:"20px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.physics.add.overlap(this.p1,this.balls,(p,b)=>{b.destroy();this.s1++;this.sTxt.setText("P1: "+this.s1+" | P2: "+this.s2);this.maybeEnd();});
    this.physics.add.overlap(this.p2,this.balls,(p,b)=>{b.destroy();this.s2++;this.sTxt.setText("P1: "+this.s1+" | P2: "+this.s2);this.maybeEnd();});
    this.k=this.input.keyboard.addKeys({w:"W",a:"A",s:"S",d:"D",up:"UP",down:"DOWN",left:"LEFT",right:"RIGHT"});
    // Spawn more balls periodically
    this.time.addEvent({delay:3000,callback:()=>{if(this.balls.countActive()<5){
      for(let i=0;i<5;i++){const b=this.add.circle(W/2+Phaser.Math.Between(-50,50),H/2+Phaser.Math.Between(-50,50),8,0xffffff);this.balls.add(b);this.physics.add.existing(b);b.body.setBounce(0.8).setDrag(50).setCollideWorldBounds(true);b.body.setVelocity(Phaser.Math.Between(-150,150),Phaser.Math.Between(-150,150));}
    }},loop:true});
  }
  maybeEnd(){if(this.s1>=15||this.s2>=15)this.add.text(W/2,H/2,(this.s1>=15?"P1":"P2")+" WINS!",{fontSize:"36px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);}
  update(){const s=350,k=this.k;
    this.p1.body.setVelocity(k.a.isDown?-s:k.d.isDown?s:0,k.w.isDown?-s:k.s.isDown?s:0);
    this.p2.body.setVelocity(k.left.isDown?-s:k.right.isDown?s:0,k.up.isDown?-s:k.down.isDown?s:0);
  }
});
