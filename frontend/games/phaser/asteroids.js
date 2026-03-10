registerGame("asteroids", "☄️ Asteroids", "← → rotate, ↑ thrust, SPACE shoot", "Free-for-all survival", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#0a0a1e");
    for (let i=0;i<80;i++) this.add.circle(Phaser.Math.Between(0,W),Phaser.Math.Between(0,H),Phaser.Math.Between(1,2),0x334466);
    const g=this.make.graphics({add:false}); g.fillStyle(0xf7c948); g.fillTriangle(0,-16,-10,12,10,12); g.generateTexture("ship",20,28); g.destroy();
    this.ship=this.physics.add.sprite(W/2,H/2,"ship"); this.ship.setDamping(true).setDrag(0.97).setMaxVelocity(300);
    this.bullets=this.physics.add.group(); this.roids=this.physics.add.group();
    this.score=0; this.scoreTxt=this.add.text(16,16,"Score: 0",{fontSize:"18px",color:"#f7c948",fontFamily:"monospace"});
    for(let i=0;i<6;i++) this.spawnRoid();
    this.physics.add.overlap(this.bullets,this.roids,(b,a)=>{b.destroy();const s=a.getData("s"),x=a.x,y=a.y;a.destroy();this.score+=(4-s)*10;this.scoreTxt.setText("Score: "+this.score);if(s>1){this.spawnRoid(s-1,x-20,y);this.spawnRoid(s-1,x+20,y);}});
    this.physics.add.overlap(this.ship,this.roids,()=>{this.ship.setPosition(W/2,H/2);this.ship.body.setVelocity(0,0);});
    this.cursors=this.input.keyboard.createCursorKeys(); this.space=this.input.keyboard.addKey("SPACE"); this.lastShot=0;
  }
  spawnRoid(s,x,y){s=s||3;x=x??Phaser.Math.Between(0,W);y=y??Phaser.Math.Between(0,H);const r=s*14,g=this.make.graphics({add:false});g.lineStyle(2,0x888888);g.strokeCircle(r,r,r);g.generateTexture("ast"+s,r*2,r*2);g.destroy();const a=this.roids.create(x,y,"ast"+s);a.setData("s",s);a.body.setVelocity(Phaser.Math.Between(-100,100),Phaser.Math.Between(-100,100));}
  update(t){
    this.ship.setAngularVelocity(this.cursors.left.isDown?-200:this.cursors.right.isDown?200:0);
    if(this.cursors.up.isDown)this.physics.velocityFromRotation(this.ship.rotation-Math.PI/2,300,this.ship.body.acceleration);else this.ship.setAcceleration(0);
    const wrap=o=>{if(o.x<-50)o.x=W+40;if(o.x>W+50)o.x=-40;if(o.y<-50)o.y=H+40;if(o.y>H+50)o.y=-40;};
    wrap(this.ship); this.roids.getChildren().forEach(wrap);
    if(this.space.isDown&&t>this.lastShot+200){this.lastShot=t;const b=this.add.circle(0,0,3,0xffffff);this.bullets.add(b);this.physics.add.existing(b);b.setPosition(this.ship.x,this.ship.y);this.physics.velocityFromRotation(this.ship.rotation-Math.PI/2,500,b.body.velocity);this.time.delayedCall(1500,()=>b.destroy());}
    if(this.roids.countActive()===0)for(let i=0;i<6;i++)this.spawnRoid();
  }
});
