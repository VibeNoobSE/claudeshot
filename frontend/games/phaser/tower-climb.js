registerGame("tower-climb", "🗼 Tower Climb", "A/D+W = P1, ←/→+↑ = P2", "Race to the top of the tower!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a1a3e");
    this.plats=this.physics.add.staticGroup();
    for(let i=0;i<20;i++){
      const x=Phaser.Math.Between(100,W-100),y=H-40-i*50;
      this.plats.add(this.add.rectangle(x,y,Phaser.Math.Between(60,130),10,0x334466));
    }
    this.plats.add(this.add.rectangle(W/2,H-10,W,20,0x334466));
    this.finish=this.add.rectangle(W/2,H-40-20*50,100,10,0xf7c948);
    this.add.text(W/2,H-50-20*50,"FINISH",{fontSize:"14px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);
    this.p1=this.add.rectangle(W/3,H-30,16,24,0xf7c948);this.p2=this.add.rectangle(W*2/3,H-30,16,24,0xe94560);
    [this.p1,this.p2].forEach(p=>{this.physics.add.existing(p);p.body.setCollideWorldBounds(true).setGravityY(600);});
    this.physics.add.collider(this.p1,this.plats);this.physics.add.collider(this.p2,this.plats);
    this.cameras.main.startFollow(this.p1,false,0.5,0.5);
    this.cameras.main.setBounds(0,-1200,W,H+1200);
    this.k=this.input.keyboard.addKeys({a:"A",d:"D",w:"W",left:"LEFT",right:"RIGHT",up:"UP"});
    this.over=false;
  }
  update(){if(this.over)return;const k=this.k;
    this.p1.body.setVelocityX(k.a.isDown?-200:k.d.isDown?200:0);
    if(k.w.isDown&&this.p1.body.touching.down)this.p1.body.setVelocityY(-450);
    this.p2.body.setVelocityX(k.left.isDown?-200:k.right.isDown?200:0);
    if(k.up.isDown&&this.p2.body.touching.down)this.p2.body.setVelocityY(-450);
    // Camera follows highest player
    const highest=this.p1.y<this.p2.y?this.p1:this.p2;
    this.cameras.main.startFollow(highest,false,0.5,0.5);
    if(this.p1.y<this.finish.y+20&&!this.over){this.over=true;this.add.text(this.p1.x,this.p1.y-40,"P1 WINS!",{fontSize:"28px",color:"#f7c948",fontFamily:"monospace"}).setOrigin(0.5);}
    if(this.p2.y<this.finish.y+20&&!this.over){this.over=true;this.add.text(this.p2.x,this.p2.y-40,"P2 WINS!",{fontSize:"28px",color:"#e94560",fontFamily:"monospace"}).setOrigin(0.5);}
  }
});
